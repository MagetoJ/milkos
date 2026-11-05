// config/navigation.ts
export const navigationItems = [
  { name: "Dashboard", href: "/dashboard", roles: ["superadmin", "collector", "admin"] },
  { name: "Milk Intake", href: "/collector", roles: ["collector", "superadmin"] },
  { name: "Hardware & Bluetooth", href: "/settings/hardware", roles: ["superadmin", "collector", "accountant"] },
  { name: "System Settings", href: "/settings", roles: ["superadmin"] },
];