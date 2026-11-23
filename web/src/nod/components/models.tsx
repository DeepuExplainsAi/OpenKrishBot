// ModelProviderLogo from nod components/models.tsx; nod's logo map lives in web/public/logos.
export type ModelProvider = string;

export function ModelProviderLogo({ provider, size = 16 }: { provider: ModelProvider; size?: number }) {
  return (
    <span
      className="model-provider-logo"
      style={{ width: size, height: size, maskImage: `url('/logos/${provider}.svg')` }}
      aria-hidden="true"
    />
  );
}
