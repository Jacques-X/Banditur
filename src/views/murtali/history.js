// Murtali: undo / redo of the item document. Documents are never mutated (items.js), so the stacks
// hold references. A drag of an edge or of a crop window is one step: begin() … live() … end().

export class History {
  constructor(doc, limit = 200) {
    this.present = doc;
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.base = null; // the document when a live edit began
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** A finished edit: the previous document becomes an undo step. No-op when nothing changed. */
  commit(doc) {
    if (doc === this.present) return this.present;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.present = doc;
    return doc;
  }
  /** Replace without a step (loading a project, detection results that are not an edit). */
  reset(doc) { this.present = doc; this.past = []; this.future = []; this.base = null; return doc; }

  begin() { if (!this.base) this.base = this.present; }
  live(doc) { this.present = doc; return doc; }
  end() {
    const base = this.base;
    this.base = null;
    if (base && base !== this.present) {
      this.past.push(base);
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    return this.present;
  }
  cancel() { if (this.base) { this.present = this.base; this.base = null; } return this.present; }

  undo() {
    if (!this.past.length) return null;
    this.future.push(this.present);
    this.present = this.past.pop();
    return this.present;
  }
  redo() {
    if (!this.future.length) return null;
    this.past.push(this.present);
    this.present = this.future.pop();
    return this.present;
  }
}
