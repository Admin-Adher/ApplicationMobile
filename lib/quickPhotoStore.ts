let _uri: string | null = null;

export function setQuickPhotoUri(uri: string): void {
  _uri = uri;
}

export function takeQuickPhotoUri(): string | null {
  const u = _uri;
  _uri = null;
  return u;
}
