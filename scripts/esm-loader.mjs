export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      return await next(specifier + '.js', context);
    }
    throw e;
  }
}
