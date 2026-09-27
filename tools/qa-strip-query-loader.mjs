/** Node loader: strip ?v= cache-bust queries so game modules import. */
export async function resolve(specifier, context, nextResolve) {
  const clean = specifier.replace(/\?.*$/, "");
  return nextResolve(clean, context);
}
