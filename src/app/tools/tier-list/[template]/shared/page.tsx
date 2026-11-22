import type { Metadata } from "next";
import { TemplateView, one, templateMetadata, type Params, type Query } from "@/components/tools/tier-list/TemplateView";

/**
 * A shared result: /tools/tier-list/<template>?s=… is rewritten here (next.config), so the template's own page stays
 * static while a link renders with its result and its own preview card. The address people see keeps ?s=.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Query> }): Promise<Metadata> {
  return templateMetadata((await params).template, one((await searchParams).s));
}

export default async function SharedPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Query> }) {
  return <TemplateView slug={(await params).template} raw={one((await searchParams).s)} />;
}
