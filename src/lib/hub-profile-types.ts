export type ProfileEvidence={field:'title'|'snippet';term:string;excerpt:string};
export type ContentProfile={
 schemaVersion:1;method:'rules_v1_not_ai';basis:'public_source_metadata';
 regions:string[];geographyStatus:'inferred'|'national'|'unknown';localImpact:'not_assessed';
 topics:string[];audienceRelevance:{'15-24':number;'25-39':number;'40+':number};audienceStatus:'inferred'|'unknown';
 usefulness:string[];contentGroup:'information'|'entertainment'|'mixed'|'unknown';
 risk:{status:'needs_review'|'not_assessed';signals:string[];familySafety:'not_verified'};
 evidence:ProfileEvidence[];
 source:{sourceId:string;sourceName:string;originalUrl:string;sourcePublishedAt:string|null;sourceDateRaw:string|null;dateStatus:'format_valid_not_fact_checked'|'missing_or_invalid';rightsRecorded:string};
 warnings:string[];
};
export type StoredProfile={profile:ContentProfile;itemVersion:number;generatedAt:string;stale:boolean};
