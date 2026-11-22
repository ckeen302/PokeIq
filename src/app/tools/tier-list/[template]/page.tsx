import type { Metadata } from "next";
import { TEMPLATES } from "@/lib/tier-list/templates";
import { TemplateView, templateMetadata, type Params } from "@/components/tools/tier-list/TemplateView";

/**
 * /tools/tier-list/<template>: the maker on one template (Starters, Gen 1, Every Pokémon…), with all four modes, a
 * static page. A shared result (?s=…) is rewritten to ./shared (next.config), which renders this same page with the
 * link's result and its own preview card, and isn't indexed on its own.
 */

export function generateStaticParams(): Params[] {
  return TEMPLATES.map((t) => ({ template: t.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return templateMetadata((await params).template, null);
}

export default async function TemplatePage({ params }: { params: Promise<Params> }) {
  return <TemplateView slug={(await params).template} raw={null} />;
}
