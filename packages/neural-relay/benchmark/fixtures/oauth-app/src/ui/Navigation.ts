export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: true },
  { label: 'Orders', href: '/orders', icon: true },
  { label: 'Billing', href: '/billing', icon: true },
  { label: 'Settings', href: '/settings', icon: true },
];

export function activeNav(href: string, current: string): boolean {
  return href === current;
}