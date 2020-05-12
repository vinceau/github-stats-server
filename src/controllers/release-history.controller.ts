// Uncomment these imports to begin using these cool features!

// import {inject} from '@loopback/context';

import {repository} from '@loopback/repository';
import {param, post} from '@loopback/rest';
import {fetchReleases} from '../lib/github';
import {DownloadCount} from '../models';
import {DownloadCountRepository} from '../repositories';

export class ReleaseHistoryController {
  constructor(
    @repository(DownloadCountRepository)
    public downloadCountRepository: DownloadCountRepository,
  ) {}

  @post('/releases/{owner}/{repo}')
  async getReleases(
    @param.path.string('owner') owner: string,
    @param.path.string('repo') repo: string,
  ) {
    const releases = await fetchReleases(owner, repo);
    for (const release of releases) {
      const releaseId = release.id;
      for (const asset of release.releaseAssets.nodes) {
        const downloadCounts = await this.fetchAndUpdateDownloadCounts(
          releaseId,
          asset.id,
          asset.downloadCount,
        );
        // Patch the asset object with the download counts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (asset as any).downloadCountHistory = downloadCounts;
      }
    }
    return releases;
  }

  /**
   * Updates the database with the new download count, or patches the most
   * latest download count with the latest timestamp if unchanged.
   *
   * @private
   * @param {string} releaseId
   * @param {string} assetId
   * @param {number} newDownloads
   * @memberof ReleaseHistoryController
   */
  private async fetchAndUpdateDownloadCounts(
    releaseId: string,
    assetId: string,
    newDownloads: number,
  ): Promise<DownloadCount[]> {
    // New updated timestamp
    const tstz = new Date();
    // Fetch the download history of the asset
    const allDownloadCounts = await this.downloadCountRepository.find({
      where: {
        and: [{releaseId}, {assetId}],
      },
      order: ['tstz ASC'],
    });
    const numCounts = allDownloadCounts.length;
    if (numCounts >= 2) {
      // We have at least two download records
      const latestDownload = allDownloadCounts[numCounts - 1];
      const secondLatestDownload = allDownloadCounts[numCounts - 2];
      if (
        newDownloads === latestDownload.downloads &&
        latestDownload.downloads === secondLatestDownload.downloads
      ) {
        // We want to patch the latest download count to simply be the latest date
        await this.downloadCountRepository.updateById(latestDownload.id, {
          ...latestDownload,
          tstz,
        });

        // Patch the latest timestamp before returning
        latestDownload.tstz = tstz;
        return allDownloadCounts;
      }
    }

    const count = new DownloadCount({
      assetId,
      releaseId,
      downloads: newDownloads,
      tstz,
    });
    await this.downloadCountRepository.create(count);
    allDownloadCounts.push(count);
    return allDownloadCounts;
  }
}
