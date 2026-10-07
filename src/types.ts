/** A Google service-account key, as found in the downloaded JSON file. */
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** A GA4 property and the hosts of its web data streams. */
export interface Ga4Property {
  id: string;
  name: string;
  account: string;
  /** Hosts of the property's web data streams (from webStreamData.defaultUri), lowercased. */
  hosts: string[];
}

/** A Search Console property and the caller's permission on it. */
export interface GscSite {
  /** "https://www.example.com/" (URL-prefix property) or "sc-domain:example.com" (Domain property). */
  siteUrl: string;
  permissionLevel: string;
}

/** GA4 range totals. */
export interface Ga4Totals {
  users: number;
  sessions: number;
  pageviews: number;
}

/** Search Console range totals. `ctr` is 0..1; `position` is null when there is none. */
export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}
