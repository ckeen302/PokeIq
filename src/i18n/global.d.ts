import type { LOCALES } from "./config";
import type { Messages } from "./messages";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: Messages;
  }
}
