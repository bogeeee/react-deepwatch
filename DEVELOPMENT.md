### Prepare

```bash
git clone https://github.com/bogeeee/react-deepwatch.git
cd react-deepwatch/react-deepwatch
npm install --ignore-scripts
```


### Run the tests
```bash
cd react-deepwatch
npm run test
```

### Run the web based (manual) tests
```bash
cd devPlayground
npm intall
npm run tests:web:prepare
npm run tests:web


# Understanding the code
First, read the jsDoc of `WatchedComponentPersistent`, `Frame` and `RenderRun` about their lifecycle / relation.
### Polling
`poll` works at first identical to load, until after the first result is loaded.
When the frame becomes "alive" (see frame#startListeningForChanges), it schedules the re-polls then.
The RecordedLoadCall#result.state is not set to "pending" during re-poll.