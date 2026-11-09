// Family cookbooks: shared recipe books on the 128bit server
// (supabase/bitrecipe-family.sql). Anyone with the 6-letter code joins.
// Shared recipes are copies: "Save to my cookbook" makes your own.

import { api, signedIn } from './account.js';

const fam = (db) => (db.family ||= { books: [], recipes: {}, cursors: {}, name: '' });

export function familyRecipes(db) {
  const f = fam(db);
  const out = [];
  for (const b of f.books) for (const r of Object.values(f.recipes[b.id] || {})) out.push({ ...r.data, _book: b.id, _bookName: b.name, _by: r.by, _shared: true });
  return out.sort((a, b) => (b._updated || 0) - (a._updated || 0));
}

export const findFamilyRecipe = (db, id) => familyRecipes(db).find((r) => r.id === id);

export async function refreshBooks(db) {
  if (!signedIn()) return;
  const f = fam(db);
  const books = await api('bitrecipe_books?select=id,name,code&order=created_at.asc');
  f.books = books;
  for (const id of Object.keys(f.recipes)) if (!books.some((b) => b.id === id)) { delete f.recipes[id]; delete f.cursors[id]; }
}

export async function createBook(db, name) {
  const b = await api('rpc/bitrecipe_create_book', { method: 'POST', body: { book_name: name, my_name: fam(db).name || '' } });
  await refreshBooks(db);
  return b;
}

export async function joinBook(db, code) {
  const b = await api('rpc/bitrecipe_join_book', { method: 'POST', body: { book_code: code, my_name: fam(db).name || '' } });
  await refreshBooks(db);
  await pullBooks(db);
  return b;
}

export async function leaveBook(db, id) {
  await api('rpc/bitrecipe_leave_book', { method: 'POST', body: { b: id } });
  await refreshBooks(db);
}

// Put a copy of one of your recipes into a book (sharing again updates it).
export async function shareToBook(db, bookId, recipe) {
  const data = { ...recipe };
  for (const k of ['importDebug', 'needsReview', 'reviewFlags', 'sample']) delete data[k];
  data.cooked = 0;
  await api('rpc/bitrecipe_book_push', { method: 'POST', body: { b: bookId, my_name: fam(db).name || '', items: [{ id: recipe.id, data, modified: Date.now() }] } });
  await pullBooks(db);
}

export async function unshare(db, bookId, id) {
  await api('rpc/bitrecipe_book_push', { method: 'POST', body: { b: bookId, my_name: fam(db).name || '', items: [{ id, deleted: true, modified: Date.now() }] } });
  delete fam(db).recipes[bookId]?.[id];
}

// Pull new/changed shared recipes for every book. Returns how many changed.
export async function pullBooks(db) {
  if (!signedIn()) return 0;
  const f = fam(db);
  let n = 0;
  for (const b of f.books) {
    f.recipes[b.id] ||= {};
    for (let page = 0; page < 20; page++) {
      const since = f.cursors[b.id] ? `&updated_at=gt.${encodeURIComponent(f.cursors[b.id])}` : '';
      const rows = await api(`bitrecipe_book_recipes?select=id,data,deleted,added_name,updated_at&book_id=eq.${b.id}${since}&order=updated_at.asc&limit=100`);
      for (const r of rows) {
        if (r.deleted) delete f.recipes[b.id][r.id];
        else f.recipes[b.id][r.id] = { data: { ...r.data, _updated: Date.parse(r.updated_at) }, by: r.added_name };
        f.cursors[b.id] = r.updated_at;
        n++;
      }
      if (rows.length < 100) break;
    }
  }
  return n;
}
