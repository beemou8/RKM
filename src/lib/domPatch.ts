/**
 * DOM Reconciliation Patch:
 * Mencegah crash fatal "Failed to execute 'insertBefore' on 'Node'" atau
 * "Failed to execute 'removeChild' on 'Node'" saat Google Translate atau
 * ekstensi browser memanipulasi text nodes di dalam DOM React.
 */
export function applyDomReconciliationPatch(): void {
  if (typeof window === 'undefined' || typeof Node === 'undefined' || !Node.prototype) {
    return;
  }

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (referenceNode.parentNode) {
        return originalInsertBefore.call(referenceNode.parentNode, newNode, referenceNode) as T;
      }
      return originalInsertBefore.call(this, newNode, null) as T;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child && child.parentNode !== this) {
      if (child.parentNode) {
        return originalRemoveChild.call(child.parentNode, child) as T;
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalReplaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function <T extends Node>(newChild: Node, oldChild: T): T {
    if (oldChild && oldChild.parentNode !== this) {
      if (oldChild.parentNode) {
        return originalReplaceChild.call(oldChild.parentNode, newChild, oldChild) as T;
      }
      this.appendChild(newChild);
      return oldChild;
    }
    return originalReplaceChild.call(this, newChild, oldChild) as T;
  };
}
