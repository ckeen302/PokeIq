import Link from "next/link";
import { Clapperboard, FileUp, Radio } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** A replay that doesn't exist, was never saved, or isn't available to this viewer. */
export default function ReplayNotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardContent className="space-y-4 p-8 text-center" data-testid="replay-not-found">
          <Clapperboard className="mx-auto h-8 w-8 text-screen" aria-hidden />
          <h1 className="font-display text-2xl font-bold uppercase">Replay not found</h1>
          <p className="text-sm text-muted-foreground">This replay doesn&apos;t exist or isn&apos;t available: the link may be wrong, or the battle was never saved.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/battle/replays" className={buttonVariants()}>
              <Clapperboard className="h-4 w-4" aria-hidden /> Browse replays
            </Link>
            <Link href="/battle/watch" className={buttonVariants({ variant: "outline" })}>
              <Radio className="h-4 w-4" aria-hidden /> Live battles
            </Link>
            <Link href="/battle/replay/import" className={buttonVariants({ variant: "outline" })}>
              <FileUp className="h-4 w-4" aria-hidden /> Import a log
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
