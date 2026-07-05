/**
 * Multi-device audio output routing — the domain model (DECISIONS.md →
 * Multi-device audio output routing).
 *
 * The rig is a GLOBAL "live setup", not per-song: one app-wide mapping of the
 * seven routable channels (six stems + the metronome click) onto physical
 * output devices, applied to whatever song is loaded. Overrides are EXCLUSIVE
 * pull-outs — an overridden channel leaves the default path entirely — so
 * routing resolves per-channel and independently; nothing is ever duplicated.
 *
 * This module is pure (no Web Audio, no Electron): types, a factory, the
 * resolver that turns the rig + the currently-connected devices into concrete
 * sink ids, plus the "stems are split across devices" check that drives the
 * drift warning. The renderer's StudioEngine consumes `resolveRouting`.
 */
import type { StemKind } from "./stems.js";
import { STEM_KINDS } from "./stems.js";

/** The Chromium sink id for the OS default output — always available. */
export const SYSTEM_SINK_ID = "default";

/**
 * A device the user has seen/tagged. `deviceId` is what `setSinkId()` takes;
 * `label` is the human name, kept as a re-matching fallback since ids can
 * rotate. Partition model: a device carries at most one `tag`.
 */
export interface SavedDevice {
  deviceId: string;
  label: string;
  /** User-assigned tag; null = untagged. A device belongs to ≤ 1 tag. */
  tag: string | null;
}

/**
 * Where a channel sends audio. `system` = the OS default output; `device` = one
 * specific output; `tag` = every connected device carrying that tag. (A
 * per-channel *override* absent from the rig means "inherit the default" — so
 * there is no explicit `inherit` variant; absence is inheritance.)
 */
export type RouteTarget =
  | { type: "system" }
  | { type: "device"; deviceId: string; label: string }
  | { type: "tag"; tag: string };

/** The seven routable channels: the six stems plus the metronome click. */
export type RoutableChannel = StemKind | "click";
export const ROUTABLE_CHANNELS: readonly RoutableChannel[] = [
  ...STEM_KINDS,
  "click",
];

/**
 * The global routing rig — the whole persisted feature state. Lives in the app
 * settings store (NOT `project.json`), so machine-specific device ids never
 * travel between computers.
 */
export interface RoutingRig {
  version: 1;
  /** Where un-overridden channels go. Multiple targets = "play on all of these". */
  defaultTarget: RouteTarget[];
  /** Exclusive per-channel overrides; a channel absent here follows the default. */
  overrides: Partial<Record<RoutableChannel, RouteTarget[]>>;
  /** Known devices + their tag assignments (the user's tag partition). */
  devices: SavedDevice[];
}

export function defaultRoutingRig(): RoutingRig {
  return {
    version: 1,
    defaultTarget: [{ type: "system" }],
    overrides: {},
    devices: [],
  };
}

/**
 * "Reset routing to System Default": clear the default target + every override
 * back to the system output, but keep the known devices and their tags.
 */
export function resetRigRouting(rig: RoutingRig): RoutingRig {
  return { ...rig, defaultTarget: [{ type: "system" }], overrides: {} };
}

/**
 * Assign (or clear) a device's tag in the partition. A device belongs to at
 * most one tag, so this replaces any prior entry; `tag === null` drops the
 * record entirely (only tagged devices are kept).
 */
export function assignDeviceTag(
  devices: SavedDevice[],
  deviceId: string,
  label: string,
  tag: string | null,
): SavedDevice[] {
  const others = devices.filter((d) => d.deviceId !== deviceId);
  return tag === null ? others : [...others, { deviceId, label, tag }];
}

/** The tag currently assigned to a device, or null if untagged. */
export function deviceTag(devices: SavedDevice[], deviceId: string): string | null {
  return devices.find((d) => d.deviceId === deviceId)?.tag ?? null;
}

/** The distinct tag names in use, sorted for stable display. */
export function allTags(devices: SavedDevice[]): string[] {
  return [...new Set(devices.map((d) => d.tag).filter((t): t is string => t !== null))].sort();
}

/** What a single channel resolves to at playback time. */
export interface ChannelRoute {
  /** Concrete sink ids to fan this channel out to (may be several). */
  deviceIds: string[];
  /** True when a per-channel override lost all its devices → play nothing
   *  (per DECISIONS: a stem override is deliberate; don't dump it into the room). */
  silent: boolean;
}

export type ResolvedRouting = Record<RoutableChannel, ChannelRoute>;

/** Resolve a target list to the concrete, currently-connected sink ids. */
function resolveTargetList(
  targets: RouteTarget[],
  devices: SavedDevice[],
  connected: Set<string>,
): string[] {
  const ids = new Set<string>();
  for (const t of targets) {
    if (t.type === "system") {
      ids.add(SYSTEM_SINK_ID);
    } else if (t.type === "device") {
      if (connected.has(t.deviceId)) ids.add(t.deviceId);
    } else {
      // tag → every *connected* device carrying it
      for (const d of devices) {
        if (d.tag === t.tag && connected.has(d.deviceId)) ids.add(d.deviceId);
      }
    }
  }
  return [...ids];
}

/**
 * Turn the rig + the ids currently reported by `enumerateDevices()` into a
 * concrete per-channel routing. Encodes the two disconnection rules:
 *   • an *override* that lost all its devices → silent (don't fall through);
 *   • the *default* target that lost all its devices → fall back to the system
 *     output (silencing the "everything" bus is worse).
 */
export function resolveRouting(
  rig: RoutingRig,
  connectedIds: Iterable<string>,
): ResolvedRouting {
  const connected = new Set(connectedIds);
  connected.add(SYSTEM_SINK_ID); // the OS default sink is always available

  const defaultIds = resolveTargetList(rig.defaultTarget, rig.devices, connected);
  const defaultResolved = defaultIds.length > 0 ? defaultIds : [SYSTEM_SINK_ID];

  const out = {} as ResolvedRouting;
  for (const ch of ROUTABLE_CHANNELS) {
    const override = rig.overrides[ch];
    if (override && override.length > 0) {
      const ids = resolveTargetList(override, rig.devices, connected);
      out[ch] =
        ids.length > 0
          ? { deviceIds: ids, silent: false }
          : { deviceIds: [], silent: true };
    } else {
      out[ch] = { deviceIds: defaultResolved, silent: false };
    }
  }
  return out;
}

/**
 * True when the loaded song's stems (excluding the click) resolve to more than
 * one distinct physical device — i.e. audio is split across devices that may be
 * on different latency domains (BT vs wired) and will audibly drift. Drives the
 * non-blocking "these will drift out of sync" warning. We can't *measure*
 * latency from the web API, so any cross-device split warns (honest, not clever).
 */
export function routingSpansMultipleDevices(resolved: ResolvedRouting): boolean {
  const ids = new Set<string>();
  for (const k of STEM_KINDS) {
    const r = resolved[k];
    if (!r.silent) for (const id of r.deviceIds) ids.add(id);
  }
  return ids.size > 1;
}
