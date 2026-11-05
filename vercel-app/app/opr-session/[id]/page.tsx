import OprSignaturePage from './OprSignaturePage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OprSignaturePage id={id} />;
}
