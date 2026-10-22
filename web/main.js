// Overview grid, switching between apps, and the footer.

// To add an app: put its page in apps/<id>.js (with a mount(element)
// function), its logo in logos/<id>.svg, and add a line here.
const APPS = [
  { id: "export", name: "Export", description: "LaTeX to Markdown or HTML" },
];

const view = document.getElementById("view");

function showGrid() {
  const grid = document.createElement("div");
  grid.className = "app-grid";
  for (const app of APPS) {
    const card = document.createElement("a");
    card.className = "app-card";
    card.href = "#" + app.id;
    card.innerHTML = `
      <img src="logos/${app.id}.svg" alt="">
      <span class="app-name">${app.name}</span>
      <span class="app-description">${app.description}</span>`;
    grid.append(card);
  }
  view.replaceChildren(grid);
}

async function showApp(app) {
  view.innerHTML = `
    <div class="app-header">
      <img src="logos/${app.id}.svg" alt="">
      <h2>${app.name}</h2>
      <a class="back" href="#">All apps</a>
    </div>
    <div class="app-body"></div>`;
  const module = await import(`./apps/${app.id}.js`);
  module.mount(view.querySelector(".app-body"));
}

function route() {
  const app = APPS.find(a => "#" + a.id === location.hash);
  if (app) showApp(app);
  else showGrid();
}

async function showFooter() {
  const about = await (await fetch("about.json")).json();
  document.getElementById("footer").textContent =
    `${about.name} ${about.version} · © ${about.year} ${about.author} · ${about.license}`;
}

window.addEventListener("hashchange", route);
route();
showFooter();
