from enum import Enum
from pydantic import BaseModel




class TaskType(str, Enum):
    compliance = "compliance"
    analyze = "analyze"
    release_listing = "release_listing"
    release_check = "release_check"





class AgentResponse(BaseModel):
    result_id: int
    task: str
    result: str
    from_cache: bool
    eval: dict | None = None


class EvalResult(BaseModel):
    score: float | None
    reasoning: str