# Spoticar ownership and platform clues

Research date: 2026-11-18. This note distinguishes ownership of the Spoticar program from the technology used to run its US website.

## Ownership and inventory

Stellantis describes Spoticar as its used-car brand. Its [US launch release](https://www.media.stellantisnorthamerica.com/newsrelease.do?id=25208&mid=1) calls it the manufacturer-approved pre-owned program for Alfa Romeo, Chrysler, Dodge, Fiat, Jeep, Ram and Wagoneer, and says the US offering brings together vehicles from participating dealers in Stellantis' dealer network. The [US Spoticar About page](https://www.spoticar.com/t1/about-spoticar) likewise describes a manufacturer-certified program built around official retailers. Stellantis' [corporate mobility page](https://www.stellantis.com/en/sustainability/engaging-our-stakeholders/customers/empowering-choice-in-mobility) explicitly calls Spoticar “Stellantis’ used car brand.”

**Conclusion:** Spoticar is Stellantis' approved-used brand/program, not an independent marketplace brand. The advertised vehicles are dealer inventory from participating retailers; the sources do not imply Stellantis owns each listed vehicle.

## Technology supplier evidence

The US [RAM search page](https://www.spoticar.com/t1/search-inventory?zipcode=12345&brand=ram&refrel=ram) showed a Carzato attribution in its footer during the public page inspection on 2026-11-18. Carzato's own [homepage](https://www.carzato.com/) describes its Online Retailing Experience platform as integrated into brand and dealer websites. Its [product page](https://www.carzato.com/product) describes inventory and retail features across brand and dealer sites; its [About page](https://www.carzato.com/about) describes Carzato as an automotive service provider.

These sources support Carzato having a technology or digital-retailing role in the US Spoticar experience. They do **not** establish that Carzato built or operates the entire Spoticar site, owns the inventory search service, or provides an authorized partner API. Carzato's own homepage also carries a dealer testimonial describing E-SHOP by Carzato as the digital-retailing partner for four Stellantis stores; that is evidence of dealer-level work, not a statement about Spoticar's core inventory platform.

## What the technical markers establish

The public search flow inspected on 2026-11-18 used `POST /api/sni`, `POST /api/updateFilter` and `/sniLoadMore`, with session and CSRF state. The page also exposed Laravel globals, jQuery/Bootstrap, AWS-related cookies and CloudFront. These are implementation and infrastructure clues, not proof of who authored or operates each component. In particular, Laravel globals or cookies suggest a Laravel application; they do not identify its builder. AWS/CloudFront indicate infrastructure or delivery layers, not the application supplier.

**Practical distinction:** treat Stellantis as the confirmed program/brand owner. Treat Carzato as a credible supplier clue for part of the web retail experience, with the exact component boundary unverified. The observed search endpoints are the live website's request flow; no public partner-feed contract is established by these sources.

## Primary sources

- [Stellantis North America: Stellantis Launches SPOTiCAR in the US (2023-08-24)](https://www.media.stellantisnorthamerica.com/newsrelease.do?id=25208&mid=1)
- [Spoticar USA: About Spoticar](https://www.spoticar.com/t1/about-spoticar)
- [Stellantis: Empowering Choice in Mobility](https://www.stellantis.com/en/sustainability/engaging-our-stakeholders/customers/empowering-choice-in-mobility)
- [Carzato: Online Retail Experience](https://www.carzato.com/)
- [Carzato: Product](https://www.carzato.com/product)
- [Carzato: About](https://www.carzato.com/about)
