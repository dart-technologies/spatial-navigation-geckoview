/**
 * Bounded DOM-walk primitive.
 *
 * Factored out of `utils/dom` so low-level modules (e.g. `core/geometry`) can
 * reuse the lazy, budget-bounded walk without creating an import cycle:
 * `utils/dom` imports from `core/geometry`, so `core/geometry` must not import
 * from `utils/dom`. This module imports only the logger, so it stays a leaf and
 * is safe to depend on from anywhere.
 */

import { createLogger } from './logger';

const log = createLogger('DOM');

/**
 * Upper bound on elements *visited* during a single scan. Every discovery walks
 * the tree lazily and stops here, so a hostile/pathological page (millions of
 * nodes, deeply nested shadow roots) can never force a full DOM enumeration.
 * Shared across recursion via a budget object. Set far above any realistic page.
 */
export const MAX_SCAN_NODES = 100_000;

/**
 * Walk elements under `root` in document (pre-order) order via
 * firstElementChild/nextElementSibling, invoking `visit` for each, until the
 * shared `budget` is exhausted (then truncate with a warning). A lazy, bounded
 * alternative to `querySelectorAll`: it never materializes a full NodeList, so a
 * hostile, very large DOM cannot force a complete enumeration before any cap
 * applies. (TreeWalker would be cleaner but is unreliable under happy-dom.)
 */
export function walkElementsBounded(
    root: ParentNode,
    budget: { nodes: number },
    visit: (el: Element) => void
): void {
    const pending: Element[] = [];
    let node: Element | null = root.firstElementChild;
    while (node) {
        if (budget.nodes <= 0) {
            log.warn('DOM scan hit node budget; truncating');
            break;
        }
        budget.nodes--;
        visit(node);
        if (node.nextElementSibling) pending.push(node.nextElementSibling);
        node = node.firstElementChild ?? pending.pop() ?? null;
    }
}
