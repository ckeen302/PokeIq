import Link from "next/link";
import { AlakazamMascot } from "@/components/AlakazamMascot";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <AlakazamMascot size={140} />
      <div>
        <h1 className="text-3xl font-black tracking-tight">
          404 — <span className="text-gradient">Foresight</span> failed
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Even Alakazam&apos;s 5000 IQ couldn&apos;t predict this page. It
          doesn&apos;t exist.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-5 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-all hover:brightness-110 active:scale-[0.98]"
      >
        Teleport home
      </Link>
    </div>
  );
}
