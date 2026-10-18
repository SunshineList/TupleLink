export const routerMode = import.meta.env.VITE_OPENWRT === '1'

export const routerEndpoint = () => `${location.origin}/cgi-bin/daed-router/graphql`
