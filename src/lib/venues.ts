// ============================================
// SCREEN VENUES
// Reads from src/content/settings/venues.json — the shared list of indoor
// billboard host venues shown by every map section that doesn't define its own.
// ============================================

import venueData from "~/content/settings/venues.json";
import { siteConfig } from "~/config/site";

interface Venue {
  name: string;
  type?: string;
  address?: string;
  image?: string;
  /** Audience lines shown on the venue card, e.g. "Age Range: 15-65". */
  details?: string[];
}

export const venueMapUrl: string = venueData.mapUrl;

// Full venue records, used by the photo cards on the locations page.
export const venues = venueData.venues as Venue[];

// MapSection-ready locations; clicking one searches Google Maps for the venue.
export const venueLocations = venues.map((v) => ({
  name: v.name,
  address: v.address,
  query: [v.name, v.address || siteConfig.location.city, siteConfig.location.state].join(", "),
}));
