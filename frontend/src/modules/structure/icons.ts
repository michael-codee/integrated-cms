import { Building, Building2, Church, Globe2, Home, Landmark, Map as MapIcon, Network, Users } from 'lucide-react';

/** Icons an administrator can pick for a structure level. */
export const LEVEL_ICONS = { landmark: Landmark, globe: Globe2, building2: Building2, church: Church, building: Building, map: MapIcon, network: Network, home: Home, users: Users };
export type LevelIcon = keyof typeof LEVEL_ICONS;
