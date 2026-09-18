/**
 * What a row means, in words a person would search for (plan 7.8.1).
 *
 * The search index used to be "whatever field happened to be text": a round was
 * indexed as its entire `plan_json`, so the only thing that matched was
 * `{"operation":"generate"}`. These expressions are the human projection of a
 * round and of an image, kept in one place because both the migration triggers
 * and the code-layer asset index build the same string.
 */

/** A round is searchable by its prompt, its count and its output spec. */
export function roundSearchContentSql(planJsonExpression: string): string {
  return 'TRIM(' +
    "COALESCE(json_extract(" + planJsonExpression + ", '$.prompt'), '') || ' ' || " +
    "COALESCE(json_extract(" + planJsonExpression + ", '$.itemCount'), '') || ' ' || " +
    "COALESCE(json_extract(" + planJsonExpression + ", '$.output.aspectRatio'), '') || ' ' || " +
    "COALESCE(json_extract(" + planJsonExpression + ", '$.output.mediaType'), '')" +
    ')';
}

/**
 * An image is searchable by what it is made of and where it went — its original
 * filename, the prompt of the round that produced it, the review feedback it
 * collected, and the deliveries it joined. Never its content hash or path.
 *
 * Legacy rows are covered too: the producing round is reachable both through
 * `run_items.asset_id` (the new column) and through the `output_of` relation.
 */
export function assetSearchContentSql(assetAlias: string): string {
  const producedPrompts =
    'SELECT group_concat(json_extract(round.plan_json, \'$.prompt\'), \' \') ' +
    'FROM run_items item ' +
    'JOIN generation_runs run ON run.id = item.run_id ' +
    'JOIN creative_rounds round ON round.id = run.round_id ' +
    'WHERE item.asset_id = ' + assetAlias + '.id ' +
    'OR item.id IN (SELECT relation.target_id FROM asset_relations relation WHERE relation.asset_id = ' + assetAlias + '.id AND relation.relation_type = \'output_of\' AND relation.target_type = \'run_item\')';
  const reviewFeedback =
    'SELECT group_concat(COALESCE(json_extract(review.feedback_json, \'$.note\'), \'\'), \' \') ' +
    'FROM review_decisions review WHERE review.asset_id = ' + assetAlias + '.id';
  const deliveryNames =
    'SELECT group_concat(delivery.name, \' \') ' +
    'FROM delivery_assets member JOIN deliveries delivery ON delivery.id = member.delivery_id ' +
    'WHERE member.asset_id = ' + assetAlias + '.id';
  return 'TRIM(' +
    "COALESCE(json_extract(" + assetAlias + ".source_json, '$.originalFilename'), '') || ' ' || " +
    "COALESCE(json_extract(" + assetAlias + ".source_json, '$.revisedPrompt'), '') || ' ' || " +
    'COALESCE((' + producedPrompts + '), \'\') || \' \' || ' +
    'COALESCE((' + reviewFeedback + '), \'\') || \' \' || ' +
    'COALESCE((' + deliveryNames + '), \'\')' +
    ')';
}
