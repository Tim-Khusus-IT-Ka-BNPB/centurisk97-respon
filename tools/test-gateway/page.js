const byId = (id) => document.getElementById(id);
const PULL_MS = 1500;
let number = location.hash.slice(1);
let seen = "";

const shown = (digits) => `0${digits.slice(2, 5)} ${digits.slice(5, 9)} ${digits.slice(9)}`.trim();
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// WhatsApp's *bold*, and links that open; everything else is plain text.
function formatted(text) {
  const parts = text.split(/(\*[^*\n]+\*|https?:\/\/\S+)/);
  return parts.map((part) => {
    if (/^\*[^*\n]+\*$/.test(part))
      return Object.assign(document.createElement("strong"), { textContent: part.slice(1, -1) });
    if (/^https?:\/\//.test(part))
      return Object.assign(document.createElement("a"), {
        textContent: part,
        href: part,
        target: "_blank",
        rel: "noopener",
      });
    return part;
  });
}

function bubble(entry) {
  const item = document.createElement("li");
  item.className = entry.from;
  if (entry.kind === "photo") item.append(Object.assign(new Image(), { src: entry.file, alt: "Photo" }));
  if (entry.kind === "document")
    item.append(
      Object.assign(document.createElement("a"), {
        className: "document",
        href: entry.file,
        target: "_blank",
        textContent: "Open the document (PDF)",
      }),
    );
  if (entry.kind === "location") item.append("Location shared\n");
  item.append(...formatted(entry.text));
  item.append(Object.assign(document.createElement("time"), { dateTime: entry.at, textContent: clock(entry.at) }));
  return item;
}

function draw({ chats }) {
  const list = byId("chats");
  list.replaceChildren(
    ...Object.entries(chats).map(([digits, entries]) => {
      const last = entries.at(-1);
      const button = Object.assign(document.createElement("button"), { type: "button" });
      button.setAttribute("aria-current", String(digits === number));
      button.append(
        Object.assign(document.createElement("strong"), { textContent: shown(digits) }),
        Object.assign(document.createElement("span"), {
          textContent: last?.text.split("\n")[0].replaceAll("*", "") ?? "",
        }),
      );
      button.addEventListener("click", () => open(digits));
      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
  list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const entries = chats[number] ?? [];
  const messages = byId("messages");
  messages.replaceChildren(
    ...(entries.length > 0
      ? entries.map(bubble)
      : [
          Object.assign(document.createElement("li"), {
            className: "empty",
            textContent: number ? "No messages yet. Write one, for example lapor." : "Pick a number on the left.",
          }),
        ]),
  );
  toEnd();
}

function toEnd() {
  byId("messages").scrollTop = byId("messages").scrollHeight;
}

async function refresh() {
  const response = await fetch("/api/outbox");
  const body = await response.json();
  const now = JSON.stringify([number, body.chats]);
  if (now === seen) return;
  seen = now;
  draw(body);
}

function open(digits) {
  number = digits;
  location.hash = digits;
  byId("as").textContent = `Writing as ${shown(digits)}`;
  byId("text").disabled = false;
  document.querySelector("#send button[type=submit]").disabled = false;
  byId("text").focus();
  void refresh();
}

async function post(body) {
  const button = document.querySelector("#send button[type=submit]");
  button.disabled = true;
  await fetch("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ number, ...body }),
  });
  button.disabled = false;
  await refresh();
}

byId("open").addEventListener("submit", (event) => {
  event.preventDefault();
  const digits = byId("number").value.replace(/\D/g, "").replace(/^0/, "62");
  const mine = /^62800\d{6,10}$/.test(digits);
  byId("refused").textContent = mine ? "" : "Use a number that begins with 0800 and has 10 to 14 digits.";
  if (mine) open(digits);
});

byId("send").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = byId("text").value.trim();
  if (!text || !number) return;
  byId("text").value = "";
  void post({ text });
});

byId("text").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  byId("send").requestSubmit();
});

byId("locate").addEventListener("click", () => {
  const place = byId("place");
  place.hidden = !place.hidden;
  byId("locate").setAttribute("aria-expanded", String(!place.hidden));
});

byId("share").addEventListener("click", () => {
  const [lat, lon] = byId("point").value.split(",").map(Number);
  if (!number || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  byId("place").hidden = true;
  byId("locate").setAttribute("aria-expanded", "false");
  void post({ location: { lat, lon } });
});

byId("photo").addEventListener("change", async () => {
  const [file] = byId("photo").files;
  if (!file || !number) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  byId("photo").value = "";
  void post({ photo: btoa(binary) });
});

addEventListener("resize", toEnd);

if (number) open(number);
void refresh();
setInterval(refresh, PULL_MS);
