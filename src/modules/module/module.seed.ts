import { AppDataSource } from "@/config/data-source";
import { Module } from "@/entities/Module";
import logger from "@/config/logger";

/**
 * Seed the `modules` table with the app's current module tree so the DB-driven nav reproduces
 * today's hardcoded sidebar exactly. Idempotent: only inserts slugs that don't exist yet, so it
 * never overwrites edits made through the admin UI on subsequent boots.
 *
 * Sections (route = null) are inserted first so their ids are available as `parent` for children.
 */

interface SeedModule {
  name: string;
  display_name: string;
  slug: string;
  description?: string;
  icon?: string | null;
  route?: string | null;
  menu_order: number;
  parent?: string; // parent slug (resolved to id after parents are inserted)
  visible?: boolean;
}

// Order + icons mirror the previous hardcoded NAV_GROUPS in AppShell.tsx.
const SECTIONS: SeedModule[] = [
  { name: "pci", display_name: "PCI", slug: "pci", icon: "MdFolder", menu_order: 1 },
  {
    name: "health-monitoring",
    display_name: "Health Monitoring",
    slug: "health-monitoring",
    icon: "MdMonitorHeart",
    menu_order: 2,
  },
  {
    name: "cron-monitoring",
    display_name: "Cron Monitoring",
    slug: "cron-monitoring",
    icon: "MdSchedule",
    menu_order: 3,
  },
  {
    name: "settings",
    display_name: "Settings",
    slug: "settings",
    icon: "MdSettings",
    menu_order: 4,
  },
];

const CHILDREN: SeedModule[] = [
  // PCI
  {
    name: "dashboard",
    display_name: "Dashboard",
    slug: "pci-dashboard",
    icon: "MdDashboard",
    route: "/pci/dashboard",
    menu_order: 1,
    parent: "pci",
  },
  {
    name: "projects",
    display_name: "Projects",
    slug: "pci-projects",
    icon: "MdFolder",
    route: "/pci/projects",
    menu_order: 2,
    parent: "pci",
  },
  {
    name: "files",
    display_name: "Files",
    slug: "pci-files",
    icon: "MdInsertDriveFile",
    route: "/pci/files",
    menu_order: 3,
    parent: "pci",
  },
  {
    name: "check-history",
    display_name: "Check History",
    slug: "pci-check-history",
    icon: "MdHistory",
    route: "/pci/check-history",
    menu_order: 4,
    parent: "pci",
  },
  // Health Monitoring
  {
    name: "monitors",
    display_name: "Monitors",
    slug: "health-monitoring-monitors",
    icon: "MdMonitorHeart",
    route: "/health-monitoring/monitors",
    menu_order: 1,
    parent: "health-monitoring",
  },
  // Cron Monitoring
  {
    name: "monitors",
    display_name: "Monitors",
    slug: "cron-monitoring-monitors",
    icon: "MdSchedule",
    route: "/cron-monitoring/monitors",
    menu_order: 1,
    parent: "cron-monitoring",
  },
  // Settings
  {
    name: "notifications",
    display_name: "Notifications",
    slug: "settings-notifications",
    icon: "MdNotifications",
    route: "/settings/notifications",
    menu_order: 1,
    parent: "settings",
  },
  {
    name: "cron-logs",
    display_name: "Cron Logs",
    slug: "settings-cron-logs",
    icon: "MdHistory",
    route: "/settings/cron-logs",
    menu_order: 2,
    parent: "settings",
  },
  {
    name: "module-management",
    display_name: "Module Management",
    slug: "settings-module-management",
    icon: "MdViewModule",
    route: "/settings/module-management",
    menu_order: 3,
    parent: "settings",
  },
];

export async function seedModules(): Promise<void> {
  const repo = AppDataSource.getRepository(Module);

  // Bootstrap-only: seed a fresh install, then never touch the table again. Keying on "is this
  // slug missing?" cannot tell a never-seeded module from one the admin deleted, so a populated
  // table is left entirely alone — deletes and edits survive restarts.
  if ((await repo.count()) > 0) {
    logger.info("[Modules] Existing modules found — skipping seed.");
    return;
  }

  const bySlug = new Map<string, Module>();

  const insert = async (s: SeedModule, parentId: number | null) => {
    if (bySlug.has(s.slug)) return bySlug.get(s.slug)!;
    const row = repo.create({
      name: s.name,
      display_name: s.display_name,
      slug: s.slug,
      description: s.description ?? null,
      icon: s.icon ?? null,
      route: s.route ?? null,
      menu_order: s.menu_order,
      parent_id: parentId,
      status: "active",
      visible: s.visible ?? true,
      permissions: [],
      config: {},
      feature_flags: {},
      dependencies: [],
    });
    const saved = await repo.save(row);
    bySlug.set(saved.slug, saved);
    return saved;
  };

  for (const s of SECTIONS) await insert(s, null);
  for (const c of CHILDREN) {
    const parent = c.parent ? bySlug.get(c.parent) : undefined;
    await insert(c, parent?.id ?? null);
  }

  logger.info(`[Modules] Seeded ${bySlug.size} module(s) into an empty table.`);
}
