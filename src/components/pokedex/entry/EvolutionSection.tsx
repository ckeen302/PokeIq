"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized art */
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { EvolutionNode } from "@/lib/pokemon/dex-types";
import { typeColor } from "@/lib/pokemon/type-colors";
import { artUrl } from "@/lib/pokemon/art";
import { TypeBadge } from "../TypeBadge";
import { cn } from "@/lib/utils";

export function EvolutionSection({ tree, currentId }: { tree: EvolutionNode; currentId: number }) {
  return (
    <div className="overflow-x-auto hud rounded-lg border bg-card p-5">
      <div className="flex justify-center">
        <Branch node={tree} currentId={currentId} depth={0} />
      </div>
    </div>
  );
}

function Branch({ node, currentId, depth }: { node: EvolutionNode; currentId: number; depth: number }) {
  const many = node.children.length > 2;
  return (
    <div className="flex flex-col items-center gap-3 md:flex-row">
      <EvoCard node={node} current={node.id === currentId} delay={depth * 0.25} />
      {node.children.length > 0 && (
        <div className={cn("gap-3", many ? "grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4" : "flex flex-col")}>
          {node.children.map((child) => (
            <div key={child.id} className={cn("flex items-center gap-2", many ? "flex-col" : "flex-col md:flex-row")}>
              <Condition conditions={child.conditions} vertical={many} delay={depth * 0.25 + 0.15} />
              <Branch node={child} currentId={currentId} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvoCard({ node, current, delay }: { node: EvolutionNode; current: boolean; delay: number }) {
  const c = typeColor(node.types[0]);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ type: "spring", stiffness: 200, damping: 16, delay }}
    >
      <Link href={`/pokemon/${node.slug}`} className="group flex w-32 flex-col items-center gap-1.5 text-center" aria-current={current ? "page" : undefined}>
        <div
          className={cn(
            "relative flex h-28 w-28 items-center justify-center rounded-full border-2 transition-transform duration-300 group-hover:scale-105",
            current ? "border-primary" : "border-white/10"
          )}
          style={{ background: `radial-gradient(circle, ${c}40, ${c}10 70%)`, boxShadow: current ? `0 0 28px -4px ${c}` : undefined }}
        >
          {current && <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/40" aria-hidden />}
          <img src={artUrl(node.id, 160)} alt={node.name} width={96} height={96} loading="lazy" className="h-24 w-24 object-contain transition-transform duration-300 group-hover:-translate-y-1" />
        </div>
        <span className={cn("text-sm font-bold", current && "text-primary")}>{node.name}</span>
        <div className="flex gap-1">
          {node.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </div>
      </Link>
    </motion.div>
  );
}

function Condition({ conditions, vertical, delay }: { conditions: string[]; vertical: boolean; delay: number }) {
  return (
    <motion.div
      className={cn("flex max-w-[11rem] items-center gap-1 text-center text-[11px] text-muted-foreground", vertical ? "flex-col" : "flex-col md:flex-row")}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay }}
    >
      <span className="rounded-lg border border-white/10 bg-background/60 px-2 py-1 leading-tight">
        {conditions.length ? conditions.join(" or ") : "Special"}
      </span>
      {vertical ? (
        <ArrowDown className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <>
          <ArrowDown className="h-4 w-4 shrink-0 text-primary md:hidden" />
          <ArrowRight className="hidden h-4 w-4 shrink-0 text-primary md:block" />
        </>
      )}
    </motion.div>
  );
}
