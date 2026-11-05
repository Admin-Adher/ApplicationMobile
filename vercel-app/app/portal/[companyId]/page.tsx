import { redirect } from 'next/navigation';

export default async function CompanyPortalPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  redirect('/web?portal=' + encodeURIComponent(companyId));
}
