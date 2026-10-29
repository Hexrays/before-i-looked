/** Status of one valid run-log event. */
export type DigestStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid events, not counts of jobs by their last status. */
export type DigestStatusCounts = Record<DigestStatus, number>;

/**
 * One row per job. Process valid events in source-file order, not timestamp order.
 * A later event can update a job even when its timestamp is earlier.
 */
export type DigestRow = {
  /** Exact job name from the log; also the row's unique key. */
  job: string;
  /** Owner from the last event, including null. Do not retain an earlier owner. */
  owner: string | null;
  /** Total valid events for this job, including retry and fail events. */
  runs: number;
  /** Number of this job's events with status retry. */
  retries: number;
  /** Status of this job's last event in source-file order. */
  lastStatus: DigestStatus;
  /**
   * Last supplied error string in source-file order, or null if none was supplied.
   * An event without an error does not clear this value, even after recovery.
   */
  lastError: string | null;
  /** Timestamp of the first event, unchanged from the source, including its offset. */
  firstAt: string;
  /** Timestamp of the last event, unchanged from the source, including its offset. */
  lastAt: string;
  /** True if any event for this job has status fail, even if the job later succeeds. */
  hadFailure: boolean;
};

/** A file that exists, including an empty file or a file with no valid events. */
export type NightDigest = {
  /** Requested night (YYYY-MM-DD), not a date derived from an event timestamp. */
  night: string;
  /**
   * One row per job, sorted by ascending job name using string < and > comparisons.
   * Do not use locale-dependent sorting. Malformed lines do not create rows.
   */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or an invalid event shape; blank lines are ignored. */
  badLines: number;
  /**
   * Event totals across all jobs. Always include ok, retry and fail, including zeros.
   * Their sum equals the sum of row.runs. counts.retry equals the sum of row.retries.
   */
  counts: DigestStatusCounts;
};

/**
 * Shared synchronous signature for the future readNight implementation.
 *
 * Read runsDir/<night>.jsonl; night must be a YYYY-MM-DD name, not a path.
 * Return null only when the file does not exist (ENOENT, including a missing runsDir).
 * An existing empty file returns { night, rows: [], badLines: 0,
 * counts: { ok: 0, retry: 0, fail: 0 } }. Propagate other file-system errors.
 *
 * Parse input at the edge: a valid event has a timestamp string at, a string job,
 * a DigestStatus status, an owner that is a string or null, and an optional string
 * error. A timestamp must be ISO 8601 with an explicit offset (or Z). Extra fields
 * are allowed. Count each malformed nonblank line once and continue reading.
 * Do not rewrite timestamps, drop null owners, or mutate the source file.
 *
 * This is a function type only; it does not export a runtime reader.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
