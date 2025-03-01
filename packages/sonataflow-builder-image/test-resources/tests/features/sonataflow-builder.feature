@docker.io/apache/incubator-kie-sonataflow-builder
Feature: Serverless Workflow builder images

  Scenario: Verify that the application is built and started correctly
    When container is started with command bash -c '/home/kogito/launch/build-app.sh && java -jar target/quarkus-app/quarkus-run.jar'
      | variable     | value |
      | SCRIPT_DEBUG | false  |
    Then check that page is served
      | property             | value             |
      | port                 | 8080              |
      | path                 | /q/health/ready   |
      | wait                 | 480               |
      | request_method       | GET               |
      | expected_status_code | 200               |
    And container log should match regex Installed features:.*kogito-serverless-workflow
    And container log should match regex Installed features:.*kie-addon-knative-eventing-extension
    And container log should match regex Installed features:.*smallrye-health

  Scenario: Verify that the application is built and started correctly when QUARKUS_EXTENSIONS env is used
    When container is started with command bash -c '/home/kogito/launch/build-app.sh && java -jar target/quarkus-app/quarkus-run.jar'
      | variable            | value                                    |
      | SCRIPT_DEBUG        | false                                     |
      | QUARKUS_EXTENSIONS  | io.quarkus:quarkus-elytron-security-jdbc |
    Then check that page is served
      | property             | value             |
      | port                 | 8080              |
      | path                 | /q/health/ready   |
      | wait                 | 480               |
      | request_method       | GET               |
      | expected_status_code | 200               |
    And container log should match regex Extension io\.quarkus:quarkus-elytron-security-jdbc.* has been installed
    And container log should match regex Installed features:.*kogito-serverless-workflow
    And container log should match regex Installed features:.*kie-addon-knative-eventing-extension
    And container log should match regex Installed features:.*smallrye-health
    And container log should match regex Installed features:.*security-jdbc

  Scenario: Verify that the embedded data-index service is running
    When container is started with command bash -c '/home/kogito/launch/build-app.sh && java -jar target/quarkus-app/quarkus-run.jar'
      | variable     | value |
      | SCRIPT_DEBUG | false  |
      | QUARKUS_EXTENSIONS  | org.kie:kogito-addons-quarkus-data-index-inmemory |
    Then check that page is served
      | property             | value                                    |
      | port                 | 8080                                     |
      | path                 | /graphql                                 |
      | request_method       | POST                                     |
      | request_body         | { "query": "{ProcessInstances{ id } }" } |
      | wait                 | 480                                      |
      | expected_status_code | 200                                      |
      | expected_phrase      | {"data":{"ProcessInstances":[]}}         |
    Then container log should match regex Installed features:.*kogito-serverless-workflow
    And container log should match regex Installed features:.*kie-addon-knative-eventing-extension
    And container log should match regex Installed features:.*smallrye-health
    And container log should match regex Installed features:.*kogito-addons-quarkus-jobs-service-embedded
    And container log should match regex Installed features:.*kogito-addons-quarkus-data-index-inmemory

