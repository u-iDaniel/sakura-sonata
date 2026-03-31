const INTERNAL_API_SECRET_HEADER = "X-Internal-API-Secret";

function getRequiredEnv(name: "AWS_LAMBDA_ENDPOINT" | "INTERNAL_API_SECRET") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function buildInternalApiUrl(path: string, query?: URLSearchParams) {
  const baseUrl = getRequiredEnv("AWS_LAMBDA_ENDPOINT");
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(
    normalizedPath,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );

  if (query) {
    url.search = query.toString();
  }

  return url.toString();
}

export async function fetchInternalApi(
  path: string,
  options: RequestInit = {},
  query?: URLSearchParams,
) {
  const secret = getRequiredEnv("INTERNAL_API_SECRET");
  const url = buildInternalApiUrl(path, query);

  const headers = new Headers(options.headers);
  headers.set(INTERNAL_API_SECRET_HEADER, secret);

  return fetch(url, {
    ...options,
    headers,
  });
}
