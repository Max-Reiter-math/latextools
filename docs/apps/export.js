// Page of the Export app. The conversion itself happens in Python
// (desktop) or in backend/export.js (browser).
import { convert } from "../backend/export.js";
import { isDesktop, python } from "../bridge.js";

const PAGE = `
  <div class="export">
    <section>
      <h3>Input</h3>
      <div class="toolbar">
        <button data-action="open">Open .tex file</button>
        <input type="file" accept=".tex,.txt" hidden>
        <span class="small file-name"></span>
      </div>
      <textarea class="input" placeholder="Paste LaTeX here, or open a file." spellcheck="false"></textarea>
    </section>
    <section>
      <h3>Output</h3>
      <div class="toolbar">
        <select class="format">
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
        <button data-action="convert">Convert</button>
        <button data-action="copy">Copy to clipboard</button>
      </div>
      <textarea class="output" readonly spellcheck="false"></textarea>
    </section>
    <section class="console-panel">
      <h3>Console</h3>
      <pre class="console"></pre>
    </section>
  </div>`;

export function mount(root) {
  root.innerHTML = PAGE;
  const $ = selector => root.querySelector(selector);
  let path = null;  // path of the opened file (desktop only), used to find \input files

  function say(message) {
    $(".console").textContent += message + "\n";
    $(".console").scrollTop = $(".console").scrollHeight;
  }

  function loaded(name, text) {
    $(".input").value = text;
    $(".file-name").textContent = name;
    say(`Opened ${name}.`);
  }

  $("[data-action=open]").onclick = async () => {
    if (!isDesktop) return $("input[type=file]").click();
    const file = await python("open_tex");
    if (file) {
      path = file.path;
      loaded(file.path, file.text);
    }
  };

  $("input[type=file]").onchange = async event => {
    const file = event.target.files[0];
    if (file) loaded(file.name, await file.text());
  };

  $("[data-action=convert]").onclick = async () => {
    const tex = $(".input").value;
    const format = $(".format").value;
    try {
      const [output, log] = isDesktop
        ? await python("export", tex, format, path)
        : convert(tex, format);
      $(".output").value = output;
      log.forEach(say);
      say(`Converted to ${format}.`);
    } catch (error) {
      say(`Error: ${error.message || error}`);
    }
  };

  $("[data-action=copy]").onclick = async () => {
    try {
      await navigator.clipboard.writeText($(".output").value);
    } catch {
      $(".output").select();  // older webviews: fall back to the copy command
      document.execCommand("copy");
    }
    say("Copied the output to the clipboard.");
  };

  if (!isDesktop) {
    say("Browser version: files pulled in with \\input, \\include or \\subfile are skipped.");
  }
}
