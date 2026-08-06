type MetadataInput = {
  title: string;
  description: string;
  robots?: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
};

function upsertMetaBy(selector: string, attr: "name" | "property", value: string) {
  let node = document.querySelector(`meta[${attr}="${selector}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attr, selector);
    document.head.appendChild(node);
  }
  node.setAttribute("content", value);
}

function upsertCanonical(url: string) {
  let node = document.querySelector('link[rel="canonical"]');
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", "canonical");
    document.head.appendChild(node);
  }
  node.setAttribute("href", url);
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const normalized = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${window.location.origin}${normalized}`;
}

// The SPA is hash-routed: real server paths always serve index.html, so the
// canonical for a page is the origin plus its hash route (e.g. `/#/spots/tarifa`).
function toCanonicalUrl(pathOrRoute: string): string {
  if (/^https?:\/\//i.test(pathOrRoute)) return pathOrRoute;
  const normalized = pathOrRoute.startsWith("/") ? pathOrRoute : `/${pathOrRoute}`;
  return `${window.location.origin}/#${normalized === "/" ? "/" : normalized}`;
}

export function applyRobotsMetadata(robots: string) {
  upsertMetaBy("robots", "name", robots);
}

export function applyPageMetadata(
  titleOrInput: string | MetadataInput,
  description?: string,
  robots: string = "index,follow",
) {
  const input: MetadataInput = typeof titleOrInput === "string"
    ? {
      title: titleOrInput,
      description: description ?? "",
      robots,
    }
    : titleOrInput;

  document.title = input.title;
  upsertMetaBy("description", "name", input.description);
  upsertMetaBy("robots", "name", input.robots ?? "index,follow");

  // Canonical = the hash route the page is actually served at (matches the
  // sitemap URLs). Explicit canonicalUrl wins and is used as-is.
  const hashRoute = window.location.hash.replace(/^#/, "").split("?")[0] || "/";
  const canonical = input.canonicalUrl
    ? toAbsoluteUrl(input.canonicalUrl)
    : input.canonicalPath
      ? toCanonicalUrl(input.canonicalPath)
      : toCanonicalUrl(hashRoute);
  upsertCanonical(canonical);

  upsertMetaBy("og:title", "property", input.ogTitle ?? input.title);
  upsertMetaBy("og:description", "property", input.ogDescription ?? input.description);
  upsertMetaBy("og:url", "property", input.ogUrl ? toAbsoluteUrl(input.ogUrl) : canonical);
  if (input.ogImage) upsertMetaBy("og:image", "property", toAbsoluteUrl(input.ogImage));
}
