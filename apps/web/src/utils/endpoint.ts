export function defaultEndpointURL(
  location: Pick<Location, 'origin' | 'protocol' | 'hostname'>,
  development: boolean,
): string {
  return development ? `${location.protocol}//${location.hostname}:2023/graphql` : `${location.origin}/graphql`
}
