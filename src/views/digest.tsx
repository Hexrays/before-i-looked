import type { NightDigest } from '../digest/types.js';

export function Digest(props: { digest: NightDigest }) {
  const { digest } = props;
  return (
    <section>
      <h1>digest · {digest.night}</h1>
      {digest.badLines > 0 && <p class="warn">{digest.badLines} malformed {digest.badLines === 1 ? 'line' : 'lines'} skipped.</p>}
      {digest.rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th><th>last status</th>
              <th>last error</th><th>first time</th><th>last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => {
              const warning = row.retries >= 3 || row.hadFailure;
              return (
                <tr class={warning ? 'warn' : undefined}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
