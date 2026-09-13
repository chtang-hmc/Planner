import { redirect } from 'next/navigation'

// Root redirect → main task view
export default function Home() {
  redirect('/tasks')
}
