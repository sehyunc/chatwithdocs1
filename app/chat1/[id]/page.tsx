import { SearchDialog } from '@/components/SearchDialog'
import React from 'react'

type Props = {}

const Page = ({ params }: { params: { id: string } }) => {
  return (
    <div>
      <SearchDialog id={params.id} />
    </div>
  )
}

export default Page
