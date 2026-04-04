use axum::{
    extract::{Path, State},
    Json,
};
use bson::{Bson, Document};
use futures::TryStreamExt;
use mongodb::options::FindOptions;
use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::{auth::rbac::ReadAccess, errors::AppError, state::AppState};

#[derive(Default)]
struct FieldInfo {
    types: std::collections::BTreeSet<String>,
    nullable: bool,
    count: usize,
}

/// Sample up to 100 documents and infer field names and BSON types.
pub async fn collection_schema(
    ReadAccess(_claims): ReadAccess,
    State(state): State<AppState>,
    Path((db, collection)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let coll: mongodb::Collection<Document> = state.db.read().await.collection(&db, &collection);

    let options = FindOptions::builder().limit(100).build();
    let mut cursor = coll.find(bson::doc! {}, options).await?;

    let mut field_map: BTreeMap<String, FieldInfo> = BTreeMap::new();
    let mut doc_count = 0usize;

    while let Some(doc) = cursor.try_next().await? {
        doc_count += 1;
        collect_fields(&doc, "", &mut field_map);
    }

    let schema: Vec<Value> = field_map
        .into_iter()
        .map(|(path, info)| {
            let types: Vec<String> = info.types.into_iter().collect();
            json!({
                "path": path,
                "types": types,
                "nullable": info.nullable,
                "occurrences": info.count,
                "coverage": if doc_count > 0 { info.count as f64 / doc_count as f64 } else { 0.0 },
            })
        })
        .collect();

    Ok(Json(json!({
        "sampled_documents": doc_count,
        "fields": schema,
    })))
}

fn collect_fields(doc: &Document, prefix: &str, map: &mut BTreeMap<String, FieldInfo>) {
    for (key, value) in doc {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };

        let entry = map.entry(path.clone()).or_default();
        entry.count += 1;

        match value {
            Bson::Null => {
                entry.nullable = true;
                entry.types.insert("null".into());
            }
            Bson::Double(_) => { entry.types.insert("double".into()); }
            Bson::String(_) => { entry.types.insert("string".into()); }
            Bson::Boolean(_) => { entry.types.insert("bool".into()); }
            Bson::Int32(_) => { entry.types.insert("int32".into()); }
            Bson::Int64(_) => { entry.types.insert("int64".into()); }
            Bson::DateTime(_) => { entry.types.insert("date".into()); }
            Bson::ObjectId(_) => { entry.types.insert("objectId".into()); }
            Bson::Array(arr) => {
                entry.types.insert("array".into());
                // Inspect element types
                for item in arr {
                    if let Bson::Document(inner) = item {
                        collect_fields(inner, &path, map);
                    }
                }
            }
            Bson::Document(inner) => {
                entry.types.insert("object".into());
                collect_fields(inner, &path, map);
            }
            Bson::Decimal128(_) => { entry.types.insert("decimal128".into()); }
            Bson::Binary(_) => { entry.types.insert("binary".into()); }
            Bson::RegularExpression(_) => { entry.types.insert("regex".into()); }
            Bson::Timestamp(_) => { entry.types.insert("timestamp".into()); }
            _ => { entry.types.insert("other".into()); }
        }
    }
}
