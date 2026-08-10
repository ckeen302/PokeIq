import type { Metadata } from "next";
import { TrainerProfile } from "@/components/TrainerProfile";

export const metadata: Metadata = {
  title: "Trainer Profile",
  description: "Your stats, global rank, badge collection and account security.",
};

export default function TrainerPage() {
  return (
    <div>
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-black tracking-tight">
          Trainer <span className="text-gradient">Profile</span>
        </h1>
      </header>
      <TrainerProfile />
    </div>
  );
}
