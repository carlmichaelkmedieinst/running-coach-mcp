export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>running-coach-mcp</h1>
      <p>
        A read-only MCP server that connects an AI client to a personal{" "}
        <a href="https://intervals.icu" target="_blank" rel="noopener noreferrer">
          Intervals.icu
        </a>{" "}
        account.
      </p>
      <ul>
        <li>
          MCP endpoint: <code>/api/mcp</code>
        </li>
        <li>
          Health check: <code>/api/health</code>
        </li>
      </ul>
      <p>See the README for setup instructions and how to test with MCP Inspector.</p>
    </main>
  );
}
