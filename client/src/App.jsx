export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <h1>Quantum Circuit Simulator</h1>
      <p>
        This is a client scaffold. The C simulator lives in <code>c/</code>.
      </p>
      <ul>
        <li>
          Run C: <code>make -C c</code>
        </li>
        <li>
          Run server: <code>npm run server</code>
        </li>
        <li>
          Run client: <code>npm run client</code>
        </li>
      </ul>
    </main>
  );
}

