// Bengaluru search areas and venues (MVP: one city). Coordinates are public landmarks.
export type Place = { slug: string; name: string; lat: number; lng: number; blurb: string };

export const CITY = { slug: "bengaluru", name: "Bengaluru", lat: 12.9716, lng: 77.5946 };

export const AREAS: Place[] = [
  { slug: "mg-road", name: "MG Road", lat: 12.9757, lng: 77.6066, blurb: "Metro-side multilevel and Brigade Road basements, a short walk to Church Street." },
  { slug: "indiranagar", name: "Indiranagar", lat: 12.9784, lng: 77.6408, blurb: "Lots along 100 Feet Road and 12th Main for restaurants and offices." },
  { slug: "koramangala", name: "Koramangala", lat: 12.9352, lng: 77.6245, blurb: "Covered decks near 5th Block, Forum and the startup offices." },
  { slug: "hsr-layout", name: "HSR Layout", lat: 12.9116, lng: 77.6474, blurb: "Owner-listed apartment bays and sector parking." },
  { slug: "whitefield", name: "Whitefield", lat: 12.9698, lng: 77.75, blurb: "ITPL and tech-park gate parking, much of it open 24 hours." },
  { slug: "hebbal", name: "Hebbal", lat: 13.0358, lng: 77.597, blurb: "Visitor decks around Manyata Tech Park and the flyover." },
  { slug: "airport", name: "Kempegowda Airport", lat: 13.1986, lng: 77.7066, blurb: "Long-stay parking for flights, booked by the day." }
];

export const VENUES: Place[] = [
  { slug: "chinnaswamy-stadium", name: "M. Chinnaswamy Stadium", lat: 12.9788, lng: 77.5996, blurb: "Book before match day; lots near MG Road fill two hours before start." },
  { slug: "manyata-tech-park", name: "Manyata Tech Park", lat: 13.0451, lng: 77.62, blurb: "Visitor parking for meetings and interviews." },
  { slug: "itpl", name: "ITPL Whitefield", lat: 12.9857, lng: 77.7366, blurb: "Gate parking for the tech park and nearby offices." },
  { slug: "forum-koramangala", name: "Nexus Koramangala (Forum)", lat: 12.9345, lng: 77.6112, blurb: "Covered parking for shopping and movies in Koramangala." },
  { slug: "kempegowda-airport", name: "Kempegowda International Airport", lat: 13.1989, lng: 77.7068, blurb: "Long-stay parking near the terminal." }
];

export const areaBySlug = (s: string | null | undefined) => AREAS.find(a => a.slug === s) ?? AREAS[0];
