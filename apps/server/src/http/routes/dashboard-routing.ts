const DASHBOARD_BASE_PATH = "/dashboard";
const DASHBOARD_INDEX_ASSET_PATH = "/index.html";

export function dashboardIndexAssetPath(): string {
  return DASHBOARD_INDEX_ASSET_PATH;
}

export function dashboardAssetPath(pathname: string): string | null {
  if (pathname === DASHBOARD_BASE_PATH || pathname === `${DASHBOARD_BASE_PATH}/`) {
    return DASHBOARD_INDEX_ASSET_PATH;
  }

  if (!pathname.startsWith(`${DASHBOARD_BASE_PATH}/`)) {
    return null;
  }

  const relative = pathname.slice(DASHBOARD_BASE_PATH.length + 1);
  if (!relative) {
    return DASHBOARD_INDEX_ASSET_PATH;
  }

  return `/${relative}`;
}

export function createDashboardAssetRequest(request: Request, assetPath: string): Request {
  const url = new URL(request.url);
  url.pathname = assetPath;
  url.search = "";
  return new Request(url, request);
}

export function isDashboardAssetRequestMethod(request: Request): boolean {
  const method = request.method.toUpperCase();
  return method === "GET" || method === "HEAD";
}

export function isDashboardSpaRouteRequest(request: Request, assetPath: string): boolean {
  if (!isDashboardAssetRequestMethod(request)) {
    return false;
  }

  if (assetPath === DASHBOARD_INDEX_ASSET_PATH || assetPath.endsWith("/")) {
    return true;
  }

  if (lastPathSegmentHasFileExtension(assetPath)) {
    return false;
  }

  if (request.headers.get("Sec-Fetch-Mode") === "navigate") {
    return true;
  }

  const accept = request.headers.get("Accept");
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

export function isUnsafeDashboardAssetPath(assetPath: string): boolean {
  return assetPath.includes("..") || assetPath.includes("\\");
}

function lastPathSegmentHasFileExtension(assetPath: string): boolean {
  const lastSegment = assetPath.split("/").pop() ?? "";
  return /\.[a-zA-Z0-9]+$/.test(lastSegment);
}
