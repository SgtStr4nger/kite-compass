function upsertMeta(name: string, content: string) {
  let node = document.querySelector(`meta[name="${name}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute("name", name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

export function applyPageMetadata(title: string, description: string, robots: string = "index,follow") {
  document.title = title;
  upsertMeta("description", description);
  upsertMeta("robots", robots);
}
