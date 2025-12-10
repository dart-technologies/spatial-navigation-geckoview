/**
 * Focus Group logic for GeckoView Spatial Navigation System
 *
 * Manages navigation regions (Focus Groups) defined by data-focus-group attributes.
 *
 * Features:
 * - Flat focus groups: data-focus-group="sidebar"
 * - Nested hierarchies: data-focus-group="sidebar.menu" (child of sidebar)
 * - Boundary modes: exit, contain, wrap, stop
 * - Enter modes: default, first, last
 * - Last-focused memory for enter-mode="last"
 *
 * Hierarchy Example:
 *   <nav data-focus-group="sidebar">
 *     <div data-focus-group="sidebar.header">...</div>
 *     <ul data-focus-group="sidebar.menu;boundary=contain">
 *       <li data-focus-group="sidebar.menu.item1">...</li>
 *       <li data-focus-group="sidebar.menu.item2">...</li>
 *     </ul>
 *     <div data-focus-group="sidebar.footer">...</div>
 *   </nav>
 */

import type { FocusableEntry } from './state';

export type BoundaryMode = 'exit' | 'contain' | 'wrap' | 'stop';
export type EnterMode = 'default' | 'last' | 'first';

export interface FocusGroupOptions {
    boundary: BoundaryMode;
    rememberLast: boolean;
    enterMode: EnterMode;
    /** Priority for navigation (higher = preferred) */
    priority: number;
    /** Whether to inherit options from parent */
    inheritOptions: boolean;
    [key: string]: unknown;
}

export interface ParsedFocusGroup {
    id: string;
    options: Partial<FocusGroupOptions>;
}

/**
 * Path utilities for hierarchical group IDs.
 */
export const GroupPath = {
    /**
     * Get the parent path of a group ID.
     * e.g., "sidebar.menu.item1" -> "sidebar.menu"
     */
    parent(id: string): string | null {
        const lastDot = id.lastIndexOf('.');
        return lastDot > 0 ? id.substring(0, lastDot) : null;
    },

    /**
     * Get the depth of a group ID.
     * e.g., "sidebar" -> 1, "sidebar.menu" -> 2, "sidebar.menu.item1" -> 3
     */
    depth(id: string): number {
        return id.split('.').length;
    },

    /**
     * Check if `childId` is a descendant of `parentId`.
     * e.g., isDescendant("sidebar.menu.item1", "sidebar") -> true
     */
    isDescendant(childId: string, parentId: string): boolean {
        return childId.startsWith(parentId + '.');
    },

    /**
     * Check if two IDs are siblings (same parent).
     */
    areSiblings(id1: string, id2: string): boolean {
        const parent1 = GroupPath.parent(id1);
        const parent2 = GroupPath.parent(id2);
        return parent1 === parent2;
    },

    /**
     * Get all ancestor IDs for a group.
     * e.g., "sidebar.menu.item1" -> ["sidebar.menu", "sidebar"]
     */
    ancestors(id: string): string[] {
        const result: string[] = [];
        let current = GroupPath.parent(id);
        while (current) {
            result.push(current);
            current = GroupPath.parent(current);
        }
        return result;
    },

    /**
     * Get the root ID (first segment).
     * e.g., "sidebar.menu.item1" -> "sidebar"
     */
    root(id: string): string {
        const firstDot = id.indexOf('.');
        return firstDot > 0 ? id.substring(0, firstDot) : id;
    },

    /**
     * Get the leaf name (last segment).
     * e.g., "sidebar.menu.item1" -> "item1"
     */
    leaf(id: string): string {
        const lastDot = id.lastIndexOf('.');
        return lastDot > 0 ? id.substring(lastDot + 1) : id;
    }
};

/**
 * Represents a logical group of focusable elements.
 * Supports hierarchical nesting via dot-notation IDs.
 */
export class FocusGroup {
    id: string;
    element: HTMLElement;
    members: FocusableEntry[];
    options: FocusGroupOptions;
    lastFocused: FocusableEntry | null;

    /** Parent group (if nested) */
    parent: FocusGroup | null = null;

    /** Child groups */
    children: Map<string, FocusGroup> = new Map();

    /** Cached depth for performance */
    private _depth: number;

    constructor(id: string, element: HTMLElement, options: Partial<FocusGroupOptions> = {}) {
        this.id = id;
        this.element = element;
        this.members = [];
        this.options = {
            boundary: options.boundary || 'exit',
            rememberLast: options.rememberLast !== false,
            enterMode: options.enterMode || 'default',
            priority: options.priority ?? 0,
            inheritOptions: options.inheritOptions !== false,
            ...options
        };
        this.lastFocused = null;
        this._depth = GroupPath.depth(id);
    }

    /**
     * Get the depth of this group in the hierarchy.
     */
    get depth(): number {
        return this._depth;
    }

    /**
     * Get the parent group ID (or null if root).
     */
    get parentId(): string | null {
        return GroupPath.parent(this.id);
    }

    /**
     * Check if this is a root-level group.
     */
    get isRoot(): boolean {
        return this._depth === 1;
    }

    /**
     * Get effective options, inheriting from parent if enabled.
     */
    getEffectiveOptions(): FocusGroupOptions {
        if (!this.options.inheritOptions || !this.parent) {
            return this.options;
        }

        const parentOptions = this.parent.getEffectiveOptions();

        return {
            ...parentOptions,
            ...this.options,
            // Don't inherit ID-specific options
            priority: this.options.priority
        };
    }

    /**
     * Set the parent group reference.
     */
    setParent(parent: FocusGroup): void {
        this.parent = parent;
        parent.children.set(this.id, this);
    }

    /**
     * Remove this group from its parent.
     */
    removeFromParent(): void {
        if (this.parent) {
            this.parent.children.delete(this.id);
            this.parent = null;
        }
    }

    addMember(entry: FocusableEntry): void {
        if (!this.members.includes(entry)) {
            this.members.push(entry);
            entry.groupId = this.id;
        }
    }

    removeMember(entry: FocusableEntry): void {
        const index = this.members.indexOf(entry);
        if (index > -1) {
            this.members.splice(index, 1);
        }
        if (entry.groupId === this.id) {
            entry.groupId = null;
        }
    }

    updateLastFocused(entry: FocusableEntry): void {
        if (this.members.includes(entry)) {
            this.lastFocused = entry;

            // Also update ancestors' lastFocused if they don't have their own
            let ancestor = this.parent;
            while (ancestor) {
                if (!ancestor.lastFocused || !document.body.contains(ancestor.lastFocused.element)) {
                    // Find the member in ancestor that contains this entry
                    const memberInAncestor = ancestor.members.find(m =>
                        m.element.contains(entry.element) || m.element === entry.element
                    );
                    if (memberInAncestor) {
                        ancestor.lastFocused = memberInAncestor;
                    }
                }
                ancestor = ancestor.parent;
            }
        }
    }

    getPreferredEntry(): FocusableEntry | undefined {
        const effectiveOptions = this.getEffectiveOptions();

        if (effectiveOptions.enterMode === 'last' && this.lastFocused && document.body.contains(this.lastFocused.element)) {
            return this.lastFocused;
        }

        if (effectiveOptions.enterMode === 'first' || effectiveOptions.enterMode === 'default') {
            return this.members[0];
        }

        return this.members[0];
    }

    /**
     * Get all descendant groups (recursive).
     */
    getAllDescendants(): FocusGroup[] {
        const result: FocusGroup[] = [];
        for (const child of this.children.values()) {
            result.push(child);
            result.push(...child.getAllDescendants());
        }
        return result;
    }

    /**
     * Get all member elements including those in descendant groups.
     */
    getAllMembers(): FocusableEntry[] {
        const result = [...this.members];
        for (const child of this.children.values()) {
            result.push(...child.getAllMembers());
        }
        return result;
    }

    /**
     * Find a child group by relative path.
     * e.g., for group "sidebar", findChild("menu.item1") returns "sidebar.menu.item1"
     */
    findChild(relativePath: string): FocusGroup | null {
        const fullId = this.id + '.' + relativePath;
        return this.children.get(fullId) ?? null;
    }

    /**
     * Check if navigation can exit this group in a given direction.
     */
    canExit(): boolean {
        const effectiveOptions = this.getEffectiveOptions();
        return effectiveOptions.boundary === 'exit' || effectiveOptions.boundary === 'wrap';
    }

    /**
     * Check if navigation should wrap within this group.
     */
    shouldWrap(): boolean {
        const effectiveOptions = this.getEffectiveOptions();
        return effectiveOptions.boundary === 'wrap';
    }
}

/**
 * Build parent-child relationships for a set of focus groups.
 * Call this after all groups have been created.
 */
export function buildGroupHierarchy(groups: Record<string, FocusGroup>): void {
    // Sort by depth (shallow first) to ensure parents exist before children
    const sortedGroups = Object.values(groups).sort((a, b) => a.depth - b.depth);

    for (const group of sortedGroups) {
        const parentId = group.parentId;
        if (parentId && groups[parentId]) {
            group.setParent(groups[parentId]);
        }
    }
}

/**
 * Parse focus group options from data-focus-group attribute.
 * Format: "id;options" or just "id"
 * Options: boundary=contain,remember=true
 */
export function parseFocusGroupAttribute(attrValue: string | null): ParsedFocusGroup | null {
    if (!attrValue) return null;

    const parts = attrValue.split(';');
    const id = parts[0].trim();
    const options: Record<string, unknown> = {};

    if (parts.length > 1) {
        parts.slice(1).forEach(part => {
            const [key, value] = part.split('=').map(s => s.trim());
            if (key && value) {
                if (value === 'true') options[key] = true;
                else if (value === 'false') options[key] = false;
                else options[key] = value;
            }
        });
    }

    // Map attribute keys to internal options
    const mappedOptions: Partial<FocusGroupOptions> = {};
    if (options.boundary) mappedOptions.boundary = options.boundary as BoundaryMode;
    if (options.remember !== undefined) mappedOptions.rememberLast = options.remember as boolean;
    if (options.enter) mappedOptions.enterMode = options.enter as EnterMode;

    return { id, options: mappedOptions };
}

/**
 * Find the nearest focus group container for an element.
 */
export function findFocusGroupContainer(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
        if (current.hasAttribute('data-focus-group')) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}
