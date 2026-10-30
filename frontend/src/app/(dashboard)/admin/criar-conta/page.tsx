import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/admin/contas?tab=criar-conta');
}
