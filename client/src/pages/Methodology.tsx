import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { SeasonBadge } from "@/components/Badges";
import { Wind, Gauge, CalendarDays, Compass, Info } from "lucide-react";
import { PublicSeoState } from "@/lib/types";
import { applyPageMetadata } from "@/lib/metadata";
import heroImg from "@/assets/hero.jpg";

export default function Methodology() {
  const { data: seo } = useQuery<PublicSeoState>({ queryKey: ["/api/seo"] });

  useEffect(() => {
    applyPageMetadata({
      title: seo?.methodologyTitle ?? "Methodology | How Kite Compass Ranks Spots",
      description: seo?.methodologyDescription ?? "Learn how Kite Compass evaluates monthly kitesurf conditions, seasonality and destination fit across global spots.",
      robots: "index,follow",
      canonicalPath: "/methodology",
      ogImage: heroImg,
    });
  }, [seo]);

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" /> How it works
        </div>
        <h1 className="font-serif text-4xl font-semibold text-foreground">Our methodology</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Kite Compass helps you decide <em>where</em> and <em>when</em> to kitesurf.
          Every spot is scored month by month, so a destination that's world-class
          in July might be quiet and windless in December — and our ranking reflects that.
        </p>

        <section className="mt-12">
          <h2 className="font-serif text-2xl font-semibold text-foreground">The Kite Compass score</h2>
          <p className="mt-3 leading-relaxed text-foreground/80">
            Each spot carries a single score from 0 to 10 for every month. A higher
            score means a better chance of great sessions — reliable wind, suitable
            conditions and a rewarding place to spend a trip. Today those scores are
            curated by hand from the underlying wind and conditions data. As we
            connect live wind sources, an automatic score will complement the
            curated one.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="font-serif text-2xl font-semibold text-foreground">What goes into a month</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Wind, title: "Average wind", body: "Typical baseline wind strength for the month, in knots." },
              { icon: Gauge, title: "Gusts", body: "How hard it blows on the stronger days — useful for kite sizing." },
              { icon: CalendarDays, title: "Wind days", body: "Roughly how many rideable days you can expect in the month." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-card-border bg-card p-5">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">All wind speeds are shown in knots.</p>
        </section>

        <section className="mt-12">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Season labels</h2>
          <p className="mt-3 leading-relaxed text-foreground/80">
            Alongside the score, each month gets a plain-language season label so you
            can scan availability at a glance:
          </p>
          <div className="mt-5 space-y-3">
            {[
              { label: "peak", text: "The best window of the year — most consistent wind and conditions." },
              { label: "side", text: "Mid season — still good, but below each spot’s top window." },
              { label: "off", text: "Off season — clearly below that spot’s stronger months, or not evaluable." },
            ].map(({ label, text }) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-card-border bg-card p-4">
                <SeasonBadge label={label} />
                <p className="text-sm text-foreground/80">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-accent/30 bg-accent/10 p-6">
          <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
            <Info className="h-5 w-5 text-accent" /> A note on accuracy
          </h2>
          <p className="mt-3 leading-relaxed text-foreground/80">
            Our data is indicative and built to help you plan and compare — it is not
            a forecast. Wind is famously local and variable. Before you travel or head
            out, always check a live forecast such as Windy or Windfinder, which we
            link directly on each spot page where available.
          </p>
        </section>
      </div>
    </SiteLayout>
  );
}
