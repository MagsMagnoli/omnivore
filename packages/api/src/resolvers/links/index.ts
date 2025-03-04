import { createOrUpdateLinkShareInfo } from '../../datalayer/links/share_info'
import { updatePage } from '../../elastic/pages'
import { env } from '../../env'
import {
  ArchiveLinkError,
  ArchiveLinkErrorCode,
  ArchiveLinkSuccess,
  MutationSetLinkArchivedArgs,
  MutationUpdateLinkShareInfoArgs,
  UpdateLinkShareInfoError,
  UpdateLinkShareInfoErrorCode,
  UpdateLinkShareInfoSuccess,
} from '../../generated/graphql'
import { analytics } from '../../utils/analytics'
import { authorized } from '../../utils/helpers'

export const updateLinkShareInfoResolver = authorized<
  UpdateLinkShareInfoSuccess,
  UpdateLinkShareInfoError,
  MutationUpdateLinkShareInfoArgs
>(async (_obj, args, { models, claims, authTrx }) => {
  const { title, description } = args.input

  console.log(
    'updateLinkShareInfoResolver',
    args.input.linkId,
    title,
    description
  )

  // TEMP: because the old API uses articles instead of Links, we are actually
  // getting an article ID here and need to map it to a link ID. When the API
  // is updated to use Links instead of Articles this will be removed.
  const link = await authTrx((tx) =>
    models.userArticle.getByArticleId(claims.uid, args.input.linkId, tx)
  )

  if (!link?.id) {
    return {
      __typename: 'UpdateLinkShareInfoError',
      errorCodes: [UpdateLinkShareInfoErrorCode.Unauthorized],
    }
  }

  const result = await authTrx((tx) =>
    createOrUpdateLinkShareInfo(tx, link.id, title, description)
  )
  if (!result) {
    return {
      __typename: 'UpdateLinkShareInfoError',
      errorCodes: [UpdateLinkShareInfoErrorCode.BadRequest],
    }
  }

  return {
    __typename: 'UpdateLinkShareInfoSuccess',
    message: 'Updated Share Information',
  }
})

export const setLinkArchivedResolver = authorized<
  ArchiveLinkSuccess,
  ArchiveLinkError,
  MutationSetLinkArchivedArgs
>(async (_obj, args, { claims, pubsub }) => {
  console.log('setLinkArchivedResolver', args.input.linkId)

  analytics.track({
    userId: claims.uid,
    event: args.input.archived ? 'link_archived' : 'link_unarchived',
    properties: {
      env: env.server.apiEnv,
    },
  })

  try {
    await updatePage(
      args.input.linkId,
      {
        archivedAt: args.input.archived ? new Date() : null,
      },
      { pubsub, uid: claims.uid, refresh: true } // refresh index to update search results
    )
  } catch (e) {
    return {
      message: 'An error occurred',
      errorCodes: [ArchiveLinkErrorCode.BadRequest],
    }
  }

  return {
    linkId: args.input.linkId,
    message: 'Link Archived',
  }
})
