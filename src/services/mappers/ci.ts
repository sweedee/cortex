/** Jenkins build JSON → domain Pipeline. */
import type { Pipeline, StageStatus } from '../../model/types';
import type { JenkinsBuild, JenkinsStatus } from '../types';

function mapStage(status: JenkinsStatus, building: boolean): StageStatus {
  switch (status) {
    case 'SUCCESS':
      return 'passed';
    case 'IN_PROGRESS':
      return 'running';
    case 'NOT_EXECUTED':
      // not reached yet while the build runs; skipped once it is over
      return building ? 'queued' : 'skipped';
    default:
      return 'failed'; // FAILED, ABORTED, UNSTABLE
  }
}

export function mapBuild(build: JenkinsBuild): Pipeline {
  const stages = build.stages.map((s) => {
    const status = mapStage(s.status, build.building);
    return {
      name: s.name,
      status,
      durationSec: status === 'queued' || status === 'skipped' ? undefined : Math.round(s.durationMillis / 1000),
      tests: s.tests && { passed: s.tests.passCount, failed: s.tests.failCount, skipped: s.tests.skipCount },
      log: s.log ?? '',
    };
  });
  const started = stages.some((s) => s.status !== 'queued');
  return {
    job: build.job,
    buildNumber: build.number,
    url: build.url,
    status: build.building ? (started || stages.length === 0 ? 'running' : 'queued') : build.result === 'SUCCESS' ? 'passed' : 'failed',
    branch: build.branch,
    commit: build.commit,
    triggeredBy: build.triggeredBy,
    startedAt: new Date(build.timestamp).toISOString(),
    stages,
    history: build.history.map((h) => ({
      buildNumber: h.number,
      status: h.result === 'SUCCESS' ? 'passed' : 'failed',
      durationSec: Math.round(h.durationMillis / 1000),
    })),
  };
}
